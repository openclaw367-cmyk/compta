import type { SVGProps } from 'react';

/** Minimal 20px line icons, one per nav item — no icon library dependency for six glyphs. */

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export function IconGrid(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M8 3.5v13" />
    </svg>
  );
}

export function IconLedger(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M4 3.5h9.5L16 6v10.5H4z" />
      <path d="M7 9.5h6M7 12.5h6" />
    </svg>
  );
}

export function IconUpload(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" />
      <path d="M4 13.5v1.5A1.5 1.5 0 0 0 5.5 16.5h9a1.5 1.5 0 0 0 1.5-1.5V13.5" />
    </svg>
  );
}

export function IconDownload(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M10 4v9M6.5 9.5 10 13l3.5-3.5" />
      <path d="M4 13.5v1.5A1.5 1.5 0 0 0 5.5 16.5h9a1.5 1.5 0 0 0 1.5-1.5V13.5" />
    </svg>
  );
}

export function IconPercent(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="6.5" cy="6.5" r="2" />
      <circle cx="13.5" cy="13.5" r="2" />
      <path d="M14.5 4.5 5 15.5" />
    </svg>
  );
}

export function IconDocument(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M5.5 3h6l3 3v10.5a.5.5 0 0 1-.5.5H5.5a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 5.5 3Z" />
      <path d="M11.5 3v3h3M7.5 10.5h5M7.5 13h5" />
    </svg>
  );
}

export function IconList(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M7 5.5h9M7 10h9M7 14.5h9" />
      <circle cx="4" cy="5.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconBuilding(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="3" width="8" height="14" rx="0.5" />
      <path d="M12.5 8.5H16v8.5h-3.5M7 6.5h2M7 9.5h2M7 12.5h2" />
    </svg>
  );
}

export function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M3.5 7.5h13M6.5 3v2.5M13.5 3v2.5" />
    </svg>
  );
}

export function IconUsers(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <circle cx="7.5" cy="7" r="2.25" />
      <path d="M3.5 16c0-2.5 1.8-4.25 4-4.25S11.5 13.5 11.5 16" />
      <circle cx="14" cy="7.5" r="1.75" />
      <path d="M13 11.9c1.8.2 3 1.7 3 4.1" />
    </svg>
  );
}
