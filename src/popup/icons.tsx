import { type ComponentChildren } from 'preact';

export function LogoIcon() {
  return (
    <svg viewBox="0 0 128 128" width="28" height="28" aria-hidden="true">
      <rect x="2" y="2" width="124" height="124" rx="28" fill="#FFE45C" />
      <path
        fill="#18213A"
        d="M42 16Q64 11 86 16L80 36Q93 51 97 68Q83 92 64 118Q45 92 31 68Q35 51 48 36Z"
      />
      <rect x="59" y="42" width="10" height="70" rx="4" fill="#FFE45C" />
      <circle cx="64" cy="66" r="10" fill="#FFE45C" />
    </svg>
  );
}

function LineIcon({
  size,
  stroke,
  children,
}: {
  size: number;
  stroke: number;
  children: ComponentChildren;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function GearIcon() {
  return (
    <LineIcon size={18} stroke={1.7}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </LineIcon>
  );
}

export function BoltIcon() {
  return (
    <LineIcon size={14} stroke={2.2}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </LineIcon>
  );
}

export function CheckIcon() {
  return (
    <LineIcon size={13} stroke={3}>
      <path d="M20 6 9 17l-5-5" />
    </LineIcon>
  );
}

export function CloseIcon() {
  return (
    <LineIcon size={14} stroke={2}>
      <path d="M6 6l12 12M18 6 6 18" />
    </LineIcon>
  );
}

export function AlertIcon() {
  return (
    <LineIcon size={14} stroke={2.2}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </LineIcon>
  );
}

export function DocumentIcon() {
  return (
    <LineIcon size={18} stroke={2}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </LineIcon>
  );
}

export function HistoryIcon() {
  return (
    <LineIcon size={18} stroke={1.7}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </LineIcon>
  );
}

export function PlusIcon() {
  return (
    <LineIcon size={15} stroke={2.2}>
      <path d="M12 5v14M5 12h14" />
    </LineIcon>
  );
}

export function ChevronUpIcon() {
  return (
    <LineIcon size={12} stroke={2}>
      <path d="M6 15l6-6 6 6" />
    </LineIcon>
  );
}

export function SendIcon() {
  return (
    <LineIcon size={16} stroke={2.2}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </LineIcon>
  );
}

export function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <LineIcon size={14} stroke={1.8}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </LineIcon>
  );
}

export function InsertIcon() {
  return (
    <LineIcon size={14} stroke={1.8}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </LineIcon>
  );
}

export function ChatIcon() {
  return (
    <LineIcon size={14} stroke={1.8}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    </LineIcon>
  );
}

export function RetryIcon() {
  return (
    <LineIcon size={14} stroke={1.8}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
    </LineIcon>
  );
}
