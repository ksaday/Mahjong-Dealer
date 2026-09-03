import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

// Placeholder redirect target for a signed-in session. S-04 Home (create a
// table, join by code, your seats — docs/32_UX/Screen_Inventory.md §3) is
// a later slice; this only proves the auth flow lands somewhere real.
export function Home() {
  const { state, logout } = useAuth();
  const navigate = useNavigate();

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "anonymous") {
    return <Navigate to="/" replace />;
  }

  return (
    <main id="main" className="screen">
      <h1>Signed in as {state.account.display_name}</h1>
      <p>The home screen (create a table, join by code, your seats) is not built yet.</p>
      <button
        type="button"
        className="button-primary"
        onClick={() => {
          void logout().then(() => navigate("/"));
        }}
      >
        Log out
      </button>
    </main>
  );
}
