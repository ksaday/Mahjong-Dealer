import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { SkipLink } from "./components/SkipLink.js";
import { ToastProvider } from "./components/Toast.js";
import { Home } from "./screens/Home.js";
import { Login } from "./screens/Login.js";
import { Register } from "./screens/Register.js";
import { Welcome } from "./screens/Welcome.js";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <SkipLink />
          <Routes>
            <Route path="/" element={<Welcome />} />
            <Route path="/register" element={<Register />} />
            <Route path="/login" element={<Login />} />
            <Route path="/home" element={<Home />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
