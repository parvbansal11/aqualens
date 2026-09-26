/** DEMO PRESENTATION FIXTURE
 * NOT MODEL OUTPUT
 * NOT PRODUCTION SURVEY EVIDENCE
 * Explicit capability-reduced presentation. No coordinates, depth, heading,
 * track, pings or temporal claims are inherited from the navigated fixture.
 */
import type { Survey } from "../lib/runtime/types";
import { epitomeNavigated } from "./epitomeNavigated";
export const epitomeNoNavigation: Survey = {
  ...epitomeNavigated,
  id: "epitomeNoNavigation",
  name: "Epitome · sonar only",
  description: "The same Contact workflow, focused on the imagery.",
  track: [],
  frames: epitomeNavigated.frames.map((f) => ({ ...f, position: null })),
  contacts: epitomeNavigated.contacts.map((c) => ({
    ...c,
    position: null,
    persistence: null,
    channels: c.channels.filter((e) => e.id !== "persistence"),
  })),
};
