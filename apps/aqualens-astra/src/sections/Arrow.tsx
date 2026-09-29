/** Hairline arrows drawn for this system (no icon-library look). */
export function Arrow({ dir = "down", size = 12 }: { dir?: "down" | "ne" | "right"; size?: number }) {
  const paths = {
    down: "M6 1v10M1.5 6.5 6 11l4.5-4.5",
    ne: "M2 10 10 2M3.5 2H10v6.5",
    right: "M1 6h10M6.5 1.5 11 6l-4.5 4.5",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d={paths[dir]} stroke="currentColor" strokeWidth="1.1" strokeLinecap="square" />
    </svg>
  );
}
