import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

// S-08 Help (docs/32_UX/Screen_Inventory.md §3). Two parts: how to use the
// table, and — unusually for a help page, and deliberately so (D-28-06) —
// what the system does not do. The second part is the product's most
// distinctive claim and answers most support requests before they're
// asked.
export function Help() {
  const { state } = useAuth();
  const navigate = useNavigate();

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "anonymous") {
    return <Navigate to="/" replace />;
  }

  return (
    <main id="main" className="screen">
      <h1>Help</h1>

      <section aria-labelledby="how-heading">
        <h2 id="how-heading">How to use the table</h2>
        <dl>
          <dt>Select a tile</dt>
          <dd>Click a tile in your rack. Click it again to deselect.</dd>

          <dt>Discard</dt>
          <dd>Select exactly one tile, choose Discard, then confirm. Every discard is permanent and public the instant you confirm it.</dd>

          <dt>Claim a discard</dt>
          <dd>Only the newest discard — the one shown ringed — can be claimed. Choose it, then confirm. Anyone may claim it, at any time, for any reason; the table does not ask why.</dd>

          <dt>Expose</dt>
          <dd>Select one or more tiles, choose Expose, then confirm. You can retract an exposure back into your hand later, and swap a tile in it for one in your hand.</dd>

          <dt>Pass tiles</dt>
          <dd>Open a pass round and say who sends to whom. Everyone selects their tiles privately; once every participant has committed, all the tiles move at once. Nobody sees what anyone else picked until then.</dd>

          <dt>Declare Mahjong</dt>
          <dd>Choose Declare Mahjong, then confirm. The other three players then accept or dispute — the table records only that you declared and whether they agreed, never who was right.</dd>

          <dt>Propose a correction</dt>
          <dd>If something went wrong, propose rewinding the table to an earlier point. The other players see exactly what would be undone and vote; silence is always treated as a rejection, never as agreement.</dd>
        </dl>
      </section>

      <section aria-labelledby="not-heading">
        <h2 id="not-heading">What this system does not do</h2>
        <ul>
          <li>It does not know the rules of Mahjong, of any variant, in any form.</li>
          <li>It does not check whether a move is legal.</li>
          <li>It does not decide who won. When a player declares Mahjong and the others accept, that agreement is all that is recorded — never a ruling.</li>
          <li>It keeps no score.</li>
          <li>It retains nothing about a game once it concludes.</li>
          <li>It cannot show you a past game — there is no history to show.</li>
          <li>Nobody — including whoever operates this system — can see your concealed tiles.</li>
        </ul>
        <p>
          If you&rsquo;re looking for a ruling, a score, or a way to review a past hand: this system
          genuinely cannot help with that. It deals the tiles and reports what players do; the rest is
          up to the people at the table.
        </p>
      </section>

      <p>
        <button type="button" className="button-link" onClick={() => navigate("/home")}>
          Back to home
        </button>
      </p>
    </main>
  );
}
