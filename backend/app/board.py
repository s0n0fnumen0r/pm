import json
import sqlite3
from pathlib import Path
from typing import Self
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.auth import require_same_origin, require_user
from app.database import connection, transaction

router = APIRouter(prefix="/api")
INITIAL_BOARD = json.loads((Path(__file__).parent / "initial_board.json").read_text(encoding="utf-8"))
COLUMN_IDS = tuple(column["id"] for column in INITIAL_BOARD["columns"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Card(StrictModel):
    id: str
    title: str
    details: str


class Column(StrictModel):
    id: str
    title: str
    cardIds: list[str]


class Board(StrictModel):
    columns: list[Column]
    cards: dict[str, Card]

    @model_validator(mode="after")
    def validate_board(self) -> Self:
        if tuple(column.id for column in self.columns) != COLUMN_IDS:
            raise ValueError("The fixed columns and their order cannot be changed")
        for card_id, card in self.cards.items():
            if not card_id or card_id != card.id or card_id in COLUMN_IDS:
                raise ValueError("Card IDs must be non-empty, match their keys, and differ from column IDs")
            if not card.title.strip():
                raise ValueError("Card titles must not be blank")
        card_ids = [card_id for column in self.columns for card_id in column.cardIds]
        if len(card_ids) != len(set(card_ids)) or set(card_ids) != set(self.cards):
            raise ValueError("Every card must appear in exactly one column")
        return self


class BoardUpdate(StrictModel):
    revision: int = Field(ge=0, le=9223372036854775806)
    board: Board


class BoardResponse(StrictModel):
    revision: int
    board: Board


def get_or_create_board(db: sqlite3.Connection, username: str) -> str:
    user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if user is None:
        user_id = str(uuid4())
        db.execute("INSERT INTO users (id, username) VALUES (?, ?)", (user_id, username))
    else:
        user_id = user["id"]

    board = db.execute("SELECT id FROM boards WHERE user_id = ?", (user_id,)).fetchone()
    if board is not None:
        return board["id"]

    board_id = str(uuid4())
    db.execute("INSERT INTO boards (id, user_id) VALUES (?, ?)", (board_id, user_id))
    seed = Board.model_validate(INITIAL_BOARD)
    for position, column in enumerate(seed.columns):
        db.execute(
            "INSERT INTO board_columns (board_id, id, title, position) VALUES (?, ?, ?, ?)",
            (board_id, column.id, column.title, position),
        )
        for card_position, card_id in enumerate(column.cardIds):
            card = seed.cards[card_id]
            db.execute(
                "INSERT INTO cards (board_id, id, column_id, title, details, position) VALUES (?, ?, ?, ?, ?, ?)",
                (board_id, card.id, column.id, card.title, card.details, card_position),
            )
    return board_id


def read_board(db: sqlite3.Connection, board_id: str) -> BoardResponse:
    revision = db.execute("SELECT revision FROM boards WHERE id = ?", (board_id,)).fetchone()["revision"]
    columns = [
        Column(id=row["id"], title=row["title"], cardIds=[])
        for row in db.execute(
            "SELECT id, title FROM board_columns WHERE board_id = ? ORDER BY position", (board_id,)
        )
    ]
    columns_by_id = {column.id: column for column in columns}
    cards: dict[str, Card] = {}
    for row in db.execute(
        "SELECT id, column_id, title, details FROM cards WHERE board_id = ? ORDER BY position", (board_id,)
    ):
        cards[row["id"]] = Card(id=row["id"], title=row["title"], details=row["details"])
        columns_by_id[row["column_id"]].cardIds.append(row["id"])
    return BoardResponse(revision=revision, board=Board(columns=columns, cards=cards))


@router.get("/board", response_model=BoardResponse)
def get_board(response: Response, username: str = Depends(require_user)) -> BoardResponse:
    response.headers["Cache-Control"] = "no-store"
    with connection() as db, transaction(db, write=True):
        return read_board(db, get_or_create_board(db, username))


@router.put("/board", response_model=BoardResponse, dependencies=[Depends(require_same_origin)])
def update_board(update: BoardUpdate, response: Response, username: str = Depends(require_user)) -> BoardResponse:
    response.headers["Cache-Control"] = "no-store"
    return replace_board(username, update.revision, update.board)


def replace_board(username: str, expected_revision: int, board: Board) -> BoardResponse:
    with connection() as db, transaction(db, write=True):
        board_id = get_or_create_board(db, username)
        changed = db.execute(
            "UPDATE boards SET revision = revision + 1 WHERE id = ? AND revision = ?",
            (board_id, expected_revision),
        ).rowcount
        if changed != 1:
            raise HTTPException(status_code=409, detail="Board has changed; reload before saving")

        existing_ids = {
            row["id"] for row in db.execute("SELECT id FROM cards WHERE board_id = ?", (board_id,))
        }
        max_position = db.execute(
            "SELECT COALESCE(MAX(position), -1) FROM cards WHERE board_id = ?", (board_id,)
        ).fetchone()[0]
        max_final_position = max((len(column.cardIds) - 1 for column in board.columns), default=-1)
        shift = max(max_position, max_final_position) + 1
        db.execute("UPDATE cards SET position = position + ? WHERE board_id = ?", (shift, board_id))

        for card_id in existing_ids - board.cards.keys():
            db.execute("DELETE FROM cards WHERE board_id = ? AND id = ?", (board_id, card_id))
        for column in board.columns:
            db.execute(
                "UPDATE board_columns SET title = ? WHERE board_id = ? AND id = ?",
                (column.title, board_id, column.id),
            )
            for position, card_id in enumerate(column.cardIds):
                card = board.cards[card_id]
                if card_id in existing_ids:
                    db.execute(
                        "UPDATE cards SET column_id = ?, title = ?, details = ?, position = ? WHERE board_id = ? AND id = ?",
                        (column.id, card.title, card.details, position, board_id, card_id),
                    )
                else:
                    db.execute(
                        "INSERT INTO cards (board_id, id, column_id, title, details, position) VALUES (?, ?, ?, ?, ?, ?)",
                        (board_id, card.id, column.id, card.title, card.details, position),
                    )
        return read_board(db, board_id)
