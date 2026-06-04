import { BrowserRouter, Route, Routes } from "react-router-dom";
import { UploadPage } from "./pages/UploadPage";
import { DownloadPage } from "./pages/DownloadPage";
import { HowItWorksPage } from "./pages/HowItWorksPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/how-it-works" element={<HowItWorksPage />} />
        <Route path="/d/:id" element={<DownloadPage />} />
      </Routes>
    </BrowserRouter>
  );
}
