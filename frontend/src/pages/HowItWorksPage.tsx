import {
  Clock,
  EyeOff,
  KeyRound,
  Lock,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { BrandRow } from "../components/BrandRow";
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
    body: "The moment you pick a file or type a note, your browser scrambles it into unreadable ciphertext. This happens on your own computer, before anything is sent anywhere.",
  },
  {
    icon: <KeyRound size={16} />,
    title: "The key lives inside your link",
    body: "Unscrambling it needs a secret key. That key is tucked into the end of your share link (after the \"#\"). Browsers are built to never send that part to any website, so it stays between you and whoever you hand the link to.",
  },
  {
    icon: <Server size={16} />,
    title: "Our server only holds a sealed box",
    body: "We receive and store just the encrypted bytes. We never get the key, so we couldn't read your file even if we wanted to, or if someone compelled us to hand it over.",
  },
  {
    icon: <EyeOff size={16} />,
    title: "Only the link can open it",
    body: "When your recipient opens the link, their browser fetches the encrypted payload, takes the key from the link, and decrypts it right there on their device. The plaintext only ever exists on your screen and theirs.",
  },
  {
    icon: <Clock size={16} />,
    title: "It doesn't stick around",
    body: "Every share has an expiry you choose, anywhere from 1 hour to 30 days. Once that time is up, the server deletes it automatically.",
  },
  {
    icon: <Trash2 size={16} />,
    title: "You can delete it anytime",
    body: "Changed your mind? Anyone holding the link can permanently delete the files before they expire. One click on the download page and the encrypted payload is gone from our server for good.",
  },
];

export function HowItWorksPage() {
  const { logoUrl, title } = useConfig();

  return (
    <div className="page">
      <div className="card">
        <BrandRow logoUrl={logoUrl} title={title} />

        <span className="section-label">Security</span>
        <h1 className="page-heading">How it works</h1>
        <p className="page-subtitle">
          The plain-English version. No technical knowledge needed. Here's what happens when you share something, and why even we can never see it.
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
            <span>What the server can and cannot see</span>
          </div>
          <div className="how-summary-cols">
            <div>
              <div className="how-summary-label can">Can see</div>
              <ul>
                <li>The size of the encrypted payload</li>
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

        <p className="status-hint" style={{ marginTop: 16 }}>
          Technically: AES-256-GCM encryption via the Web Crypto API, run entirely in your browser. The server has no decryption code.
        </p>

        <div className="open-source-note">
          <p>
            Powered by open source code at{" "}
            <a href="https://github.com/a7ul/safeshare" target="_blank" rel="noopener noreferrer" className="open-source-link">
              a7ul/safeshare
            </a>
            . The code is intentionally open source so anyone can verify the security of it.
          </p>
        </div>

        <div className="card-footer">
          <a href="/" className="btn-outline" style={{ textDecoration: "none" }}>
            <Lock size={13} /> Share something securely
          </a>
        </div>
      </div>
    </div>
  );
}
