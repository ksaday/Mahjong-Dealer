import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { SkipLink } from "./components/SkipLink.js";
import { ToastProvider } from "./components/Toast.js";
import { Account } from "./screens/Account.js";
import { Administration } from "./screens/Administration.js";
import { Help } from "./screens/Help.js";
import { Home } from "./screens/Home.js";
import { Login } from "./screens/Login.js";
import { Register } from "./screens/Register.js";
import { Table } from "./screens/Table.js";
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
            <Route path="/account" element={<Account />} />
            <Route path="/help" element={<Help />} />
            <Route path="/admin" element={<Administration />} />
            <Route path="/tables/:tableId" element={<Table />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
