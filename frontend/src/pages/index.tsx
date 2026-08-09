import { Navigate } from "react-router-dom";

export default function Dashboard(): React.JSX.Element {
  return <Navigate to="/tasks" replace />;
}
