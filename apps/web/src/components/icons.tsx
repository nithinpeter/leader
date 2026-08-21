import type { SVGProps } from 'react'

/**
 * Inline lucide-style icons, so the dashboard needs no icon dependency.
 * All are 24×24, stroke-based, and size via the `size` prop (default 16).
 */
function makeIcon(name: string, children: React.ReactNode) {
  function Icon({
    size = 16,
    ...props
  }: SVGProps<SVGSVGElement> & { size?: number }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    )
  }
  Icon.displayName = name
  return Icon
}

export const LayoutDashboardIcon = makeIcon(
  'LayoutDashboardIcon',
  <>
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </>,
)

export const UsersIcon = makeIcon(
  'UsersIcon',
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
)

export const PlusIcon = makeIcon(
  'PlusIcon',
  <>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </>,
)

export const UploadIcon = makeIcon(
  'UploadIcon',
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m17 8-5-5-5 5" />
    <path d="M12 3v12" />
  </>,
)

export const SearchIcon = makeIcon(
  'SearchIcon',
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
)

export const PanelLeftIcon = makeIcon(
  'PanelLeftIcon',
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M9 3v18" />
  </>,
)

export const SunIcon = makeIcon(
  'SunIcon',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </>,
)

export const MoonIcon = makeIcon(
  'MoonIcon',
  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
)

export const BellIcon = makeIcon(
  'BellIcon',
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>,
)

export const LogOutIcon = makeIcon(
  'LogOutIcon',
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" x2="9" y1="12" y2="12" />
  </>,
)

export const ChevronLeftIcon = makeIcon(
  'ChevronLeftIcon',
  <path d="m15 18-6-6 6-6" />,
)

export const ChevronRightIcon = makeIcon(
  'ChevronRightIcon',
  <path d="m9 18 6-6-6-6" />,
)

export const ChevronsLeftIcon = makeIcon(
  'ChevronsLeftIcon',
  <>
    <path d="m11 17-5-5 5-5" />
    <path d="m18 17-5-5 5-5" />
  </>,
)

export const ChevronsRightIcon = makeIcon(
  'ChevronsRightIcon',
  <>
    <path d="m6 17 5-5-5-5" />
    <path d="m13 17 5-5-5-5" />
  </>,
)

export const MoreHorizontalIcon = makeIcon(
  'MoreHorizontalIcon',
  <>
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
    <circle cx="5" cy="12" r="1" />
  </>,
)

export const FileTextIcon = makeIcon(
  'FileTextIcon',
  <>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M10 9H8" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
  </>,
)

export const ExternalLinkIcon = makeIcon(
  'ExternalLinkIcon',
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>,
)

export const TrashIcon = makeIcon(
  'TrashIcon',
  <>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" x2="10" y1="11" y2="17" />
    <line x1="14" x2="14" y1="11" y2="17" />
  </>,
)

export const PencilIcon = makeIcon(
  'PencilIcon',
  <>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </>,
)

export const MailIcon = makeIcon(
  'MailIcon',
  <>
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </>,
)

export const TrendingUpIcon = makeIcon(
  'TrendingUpIcon',
  <>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </>,
)

export const GlobeIcon = makeIcon(
  'GlobeIcon',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </>,
)

export const SparklesIcon = makeIcon(
  'SparklesIcon',
  <>
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </>,
)

export const AlertCircleIcon = makeIcon(
  'AlertCircleIcon',
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" x2="12" y1="8" y2="12" />
    <line x1="12" x2="12.01" y1="16" y2="16" />
  </>,
)

export const CheckIcon = makeIcon('CheckIcon', <path d="M20 6 9 17l-5-5" />)

export const RefreshIcon = makeIcon(
  'RefreshIcon',
  <>
    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
  </>,
)

export const SendIcon = makeIcon(
  'SendIcon',
  <>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </>,
)

export const CopyIcon = makeIcon(
  'CopyIcon',
  <>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </>,
)

export const MegaphoneIcon = makeIcon(
  'MegaphoneIcon',
  <>
    <path d="m3 11 18-5v12L3 14v-3z" />
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </>,
)

export const PaletteIcon = makeIcon(
  'PaletteIcon',
  <>
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </>,
)

export const ImageIcon = makeIcon(
  'ImageIcon',
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </>,
)
