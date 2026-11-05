const paths = {
  journal: "M5 3h14v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v18M10 8h6M10 12h6",
  history: "M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-5v6l4 2",
  chart: "M4 3v17h17M8 15v-4m5 4V7m5 8V5",
  approval: "M9 4H5v17h14V4h-4M9 2h6v5H9Zm-1 12 3 3 5-6",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M9 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm8 .2a4 4 0 0 1 0 7.6",
  department: "M9 3h6v5H9ZM2 16h6v5H2Zm14 0h6v5h-6ZM5 16v-4h14v4m-7-8v4",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6",
  reward: "M8 3h8v7a4 4 0 0 1-8 0Zm0 2H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-4 0h8",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  logout: "M9 4H4v16h5m6-13 5 5-5 5m-7-5h12"
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
