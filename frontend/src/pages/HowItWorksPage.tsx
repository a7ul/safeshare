import {
  Clock,
  EyeOff,
  KeyRound,
  Lock,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useConfig } from "../hooks/useConfig";

interface Step {
  icon: React.ReactNode;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <Lock size={16} />,
    title: "It's locked on your device",
    body:
      "The moment you pick a file or type a note, your browser scrambles it into unreadable gibberish. This happens on your own computer — before anything is sent anywhere.",
  },
  {
    icon: <KeyRound size={16} />,
    title: "The key lives inside your link",
    body:
      "Unscrambling it needs a secret key. That key is tucked into the end of your share link (the part after the “#”). Browsers are built to never send that part to any website — so it stays between you and whoever you hand the link to.",
  },
  {
    icon: <Server size={16} />,
    title: "Our server only holds a sealed box",
    body:
      "We receive and store just the scrambled version. We never get the key, so we couldn't read your file even if we wanted to — or if someone demanded we hand it over.",
  },
  {
    icon: <EyeOff size={16} />,
    title: "Only the link can open it",
    body:
      "When the person you shared with opens the link, their browser fetches the sealed box, takes the key from the link, and unscrambles it right there on their device. The readable content only ever exists on your screen and theirs.",
  },
  {
    icon: <Clock size={16} />,
    title: "It doesn't stick around",
    body:
      "Every share has an expiry you choose — anywhere from 1 hour to 30 days. Once that time is up, it's deleted automatically.",
  },
  {
    icon: <Trash2 size={16} />,
    title: "You can delete it anytime",
    body:
      "Changed your mind? Anyone holding the link can permanently delete the files before they expire — one click on the download page, and the sealed box is wiped from our server for good.",
  },
];

export function HowItWorksPage() {
  const { logoUrl, title } = useConfig();

  return (
    <div className="page">
      <div className="card">
        <div className="brand-row">
          {logoUrl
            ? <img src={logoUrl} alt={title ?? ""} className="brand-logo" />
            : <Lock size={14} className="brand-icon" />}
          {title && <span className="card-title">{title}</span>}
        </div>

        <h1 className="card-heading">How it works</h1>
        <p className="card-subtitle">
          The plain-English version — no technical knowledge needed. Here's what
          happens when you share something, and why even we can never see it.
        </p>

        <div className="how-steps">
          {STEPS.map((s, i) => (
            <div className="how-step" key={i}>
              <div className="how-step-icon">{s.icon}</div>
              <div className="how-step-body">
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="how-summary">
          <div className="how-summary-head">
            <ShieldCheck size={15} />
            <span>What the server can — and can't — see</span>
          </div>
          <div className="how-summary-cols">
            <div>
              <div className="how-summary-label can">Can see</div>
              <ul>
                <li>The size of the sealed box</li>
                <li>When the share expires</li>
              </ul>
            </div>
            <div>
              <div className="how-summary-label cant">Never sees</div>
              <ul>
                <li>Your files or notes</li>
                <li>File names or their contents</li>
                <li>The key that unlocks them</li>
              </ul>
            </div>
          </div>
        </div>

        <p className="status-hint" style={{ marginTop: 16, textAlign: "center" }}>
          For the technically curious: encryption is AES-256-GCM, run entirely in
          your browser via the Web Crypto API. The server has no decryption code.
        </p>

        <div style={{ borderTop: "1px solid var(--pebble)", marginTop: 24, paddingTop: 20 }}>
          <a href="/" className="btn-outline" style={{ display: "flex", textDecoration: "none" }}>
            <Lock size={13} /> Share something securely
          </a>
        </div>
      </div>
    </div>
  );
}
