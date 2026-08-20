export type IconName =
  | 'today'
  | 'capture'
  | 'library'
  | 'curriculum'
  | 'insights'
  | 'settings'
  | 'camera'
  | 'image'
  | 'refresh'
  | 'rotate'
  | 'check'
  | 'plus'
  | 'chevron'
  | 'close'
  | 'plus'
  | 'trash'
  | 'alert'
  | 'info'
  | 'ai'
  | 'sun'
  | 'moon'
  | 'download'
  | 'print'
  | 'favorite'

const paths: Record<IconName, React.ReactNode> = {
  today: (
    <>
      <path d="M4 5.5h16v14H4z" />
      <path d="M8 3v5M16 3v5M4 10h16" />
    </>
  ),
  capture: (
    <>
      <path d="M4 7h3l1.4-2h7.2L17 7h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  library: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M8 4v16M11 8h5" />
    </>
  ),
  curriculum: (
    <>
      <path d="M4 5.5h6.5A3.5 3.5 0 0 1 14 9v10H7.5A3.5 3.5 0 0 0 4 22z" />
      <path d="M20 5.5h-2A4 4 0 0 0 14 9v10h2.5A3.5 3.5 0 0 1 20 22z" />
    </>
  ),
  insights: (
    <>
      <path d="M5 20V9M12 20V4M19 20v-7" />
      <path d="M3 20h18" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.3 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.3 3.1h5l.3-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" />
    </>
  ),
  camera: (
    <>
      <path d="M4 7h3l1.5-2h7L17 7h3v12H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="m5 18 4.5-4.5 3 3 2-2L19 19" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.4 6.3A8 8 0 1 0 20 14" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M18.5 6.5A8 8 0 1 0 20 14" />
      <path d="M9 9h6v6H9z" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  trash: (
    <>
      <path d="M5 7h14M9 7V4h6v3M7.5 7l.8 13h7.4l.8-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6M12 7.5h.01" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3.5 13.4 8l4.1 1.4-4.1 1.4L12 15.5l-1.4-4.7-4.1-1.4L10.6 8z" />
      <path d="m18.5 14 .8 2.4 2.2.8-2.2.8-.8 2.5-.8-2.5-2.2-.8 2.2-.8z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
  print: <><path d="M7 9V4h10v5M7 16H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v7H7z" /></>,
  favorite: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />,
}

export function Icon({
  name,
  size = 20,
}: {
  name: IconName
  size?: number
}) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      focusable="false"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      >
        {paths[name]}
      </g>
    </svg>
  )
}
