import { BrowserRouter, Route, Routes } from "react-router-dom";
import { UploadPage } from "./pages/UploadPage";
import { DownloadPage } from "./pages/DownloadPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/d/m" element={<DownloadPage />} />
        <Route path="/d/:id" element={<DownloadPage />} />
      </Routes>
    </BrowserRouter>
  );
}
