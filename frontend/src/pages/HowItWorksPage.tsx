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
    title: "Encrypted on your device",
    body: "Before anything leaves your device, your browser encrypts the file or note. The server never sees the original content.",
  },
  {
    icon: <KeyRound size={16} />,
    title: "The key is in the link",
    body: "The decryption key is embedded in the link itself, after the # symbol. Browsers never send that part to a server, so only the person with the link can decrypt it.",
  },
  {
    icon: <Server size={16} />,
    title: "The server stores only encrypted data",
    body: "We store the encrypted result and nothing else. We have no access to the key, so we cannot read your files regardless of what we are asked.",
  },
  {
    icon: <EyeOff size={16} />,
    title: "Decrypted on the recipient's device",
    body: "When the recipient opens the link, their browser fetches the encrypted file and decrypts it locally. The content exists in plaintext only on your devices.",
  },
  {
    icon: <Clock size={16} />,
    title: "Automatically expires",
    body: "Every share expires after a time you choose, from 1 hour to 30 days. After that, the file is deleted from the server automatically.",
  },
  {
    icon: <Trash2 size={16} />,
    title: "Delete it anytime",
    body: "Anyone with the link can delete the file from the server before it expires. One click on the download page removes it permanently.",
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
          Here's what's happening.
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
          Files and notes are encrypted using AES-256-GCM directly in your browser. The server stores only the encrypted result and has no ability to read it.
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
