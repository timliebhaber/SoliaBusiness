import type { SVGProps } from "react";

/** Schlichte Strichsymbole im Stil der System-UI — bewusst ohne Icon-Paket. */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const IconDashboard = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 13a9 9 0 0 1 18 0" />
    <path d="M12 13l4-3.5" />
    <path d="M3 13h2M19 13h2M12 4v1" />
  </Icon>
);

export const IconUsers = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19.5a5.5 5.5 0 0 0-2-4.2" />
  </Icon>
);

export const IconClock = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.4V12l3.2 2" />
  </Icon>
);

export const IconReceipt = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5.5 3.5h13v17l-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5-2.3-1.5z" />
    <path d="M9 8h6M9 12h6" />
  </Icon>
);

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
  </Icon>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} strokeWidth={2.6}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Icon>
);

export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <path d="M8 5.5v13l11-6.5z" />
  </Icon>
);

export const IconStop = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </Icon>
);

export const IconTrash = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4.8h5v1.7M6.5 6.5l1 13h9l1-13" />
  </Icon>
);

export const IconPencil = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 19.5h4L19 9a2.1 2.1 0 0 0-3-3L4.5 17.5z" />
  </Icon>
);

export const IconAlert = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5M12 16.2v.1" />
  </Icon>
);

export const IconInfo = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.1" />
  </Icon>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />
  </Icon>
);

export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 13.8a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.3 1.3" />
    <path d="M14 10.2a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.3-1.3" />
  </Icon>
);

export const IconX = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Icon>
);

export const IconChevron = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const IconArchive = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5.5 8.5v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-10M10 12.5h4" />
  </Icon>
);

export const IconInbox = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4" />
    <path d="M5.8 4.5h12.4l2.3 9v5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1v-5z" />
  </Icon>
);
