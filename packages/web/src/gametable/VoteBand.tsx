// The one votes pattern shared by corrections, declarations, and end-game
// proposals (docs/32_UX/Interaction_Patterns.md §3): a band across the
// table centre, who proposed what, each seat's response or that it is
// still waiting, and — for the two vote kinds with a timeout — that
// silence is a rejection, never an acceptance (D-32-32).
import { SEAT_ORDER, type Seat } from "@mahjong-dealer/shared";
import { seatLabel } from "./seatLayout.js";

export interface VoteBandProps {
  readonly headline: string;
  readonly detail?: readonly string[];
  readonly proposer: Seat;
  readonly responses: Readonly<Partial<Record<Seat, string>>>;
  readonly responseLabels: Readonly<Record<string, string>>;
  readonly ownSeat: Seat;
  readonly ownResponded: boolean;
  readonly actions?: readonly { readonly label: string; readonly onClick: () => void; readonly primary?: boolean }[];
  readonly note?: string;
}

export function VoteBand({ headline, detail, proposer, responses, responseLabels, ownSeat, ownResponded, actions, note }: VoteBandProps) {
  return (
    <div className="vote-band" role="status">
      <p className="vote-headline">{headline}</p>
      {detail !== undefined && detail.length > 0 && (
        <ul className="vote-detail">
          {detail.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <ul className="vote-progress">
        {SEAT_ORDER.filter((seat) => seat !== proposer).map((seat) => {
          const response = responses[seat];
          return (
            <li key={seat}>
              <span className="vote-seat-name">{seat === ownSeat ? `${seatLabel(seat)} (you)` : seatLabel(seat)}</span>{" "}
              {response !== undefined ? (
                <span className="vote-responded">✔ {responseLabels[response] ?? response}</span>
              ) : (
                <span className="vote-waiting">… waiting</span>
              )}
            </li>
          );
        })}
      </ul>
      {actions !== undefined && actions.length > 0 && !ownResponded && (
        <div className="vote-actions">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.primary ? "button-primary" : "button-link"}
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {note !== undefined && <p className="vote-note">{note}</p>}
    </div>
  );
}
