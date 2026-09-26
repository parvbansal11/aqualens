import { Link, Navigate } from "react-router-dom";
import { useWorkspace } from "../lib/store";
import { capabilities } from "../lib/runtime/selectors";
import { Empty } from "../components/ui";
import SurveyMap from "../components/SurveyMap";
export default function MapPage() {
  const { survey, role } = useWorkspace();
  if (role === "decision") return <Navigate to="/workspace" replace />;
  if (!survey || !capabilities(survey).navigation)
    return (
      <main id="main-content" className="workspace-main">
        <Empty title="Stay with the sonar.">
          <p>Navigation not supplied for this survey.</p>
          <Link className="button" to="/workspace/results">
            Explore Contacts
          </Link>
        </Empty>
      </main>
    );
  return (
    <main id="main-content" className="map-main">
      <SurveyMap key={survey.id} survey={survey} />
    </main>
  );
}
