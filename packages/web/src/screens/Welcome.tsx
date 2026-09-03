import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

// S-01 Welcome (docs/32_UX/Screen_Inventory.md §3). States: default,
// already authenticated (redirects to S-04 Home).
export function Welcome() {
  const { state } = useAuth();

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "authenticated") {
    return <Navigate to="/home" replace />;
  }

  return (
    <main id="main" className="screen">
      <h1>American Mahjong Dealer</h1>
      <p>
        It shuffles, deals, and enforces turn order for a table of four. It does not know the rules
        of Mahjong, and it never shows your tiles to anyone else.
      </p>
      <p>
        <Link to="/register" className="button-link">
          Create an account
        </Link>
      </p>
      <p>
        <Link to="/login" className="button-link">
          Log in
        </Link>
      </p>
    </main>
  );
}
