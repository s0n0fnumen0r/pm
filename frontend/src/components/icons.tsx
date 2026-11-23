import type { ReactNode } from "react";

const Icon = ({ children }: { children: ReactNode }) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    {children}
  </svg>
);

export const EditIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M13 7l4 4" />
  </Icon>
);

export const DeleteIcon = () => (
  <Icon>
    <path d="M4 7h16" />
    <path d="M9 7V4h6v3" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SendIcon = () => (
  <Icon>
    <path d="M4 12l16-8-6 16-3-6-7-2z" />
  </Icon>
);

export const PowerIcon = () => (
  <Icon>
    <path d="M12 3v8" />
    <path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
  </Icon>
);
