import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import AuthGate from "./components/AuthGate";
import ErrorBoundary from "./components/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import Quotes from "./pages/Quotes";
import Orders from "./pages/Orders";
import QuoteEditor from "./pages/QuoteEditor";
import DocumentView from "./pages/DocumentView";
import Clients from "./pages/Clients";
import ClientForm from "./pages/ClientForm";
import Invoices from "./pages/Invoices";
import Settings from "./pages/Settings";
import PublicAccept from "./pages/PublicAccept";

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/accept/:id" element={<PublicAccept />} />
        <Route
          path="*"
          element={
            <AuthGate>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/quotes" element={<Quotes />} />
                  <Route path="/quotes/new" element={<QuoteEditor kind="quote" />} />
                  <Route path="/quotes/:id" element={<QuoteEditor kind="quote" />} />
                  <Route path="/quotes/:id/view" element={<DocumentView kind="quote" />} />
                  <Route path="/orders" element={<Orders />} />
                  <Route path="/orders/new" element={<QuoteEditor kind="order" />} />
                  <Route path="/orders/:id" element={<QuoteEditor kind="order" />} />
                  <Route path="/orders/:id/view" element={<DocumentView kind="order" />} />
                  <Route path="/clients" element={<Clients />} />
                  <Route path="/clients/new" element={<ClientForm />} />
                  <Route path="/clients/:id" element={<ClientForm />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/invoices/:id" element={<DocumentView kind="invoice" />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
              </Routes>
            </AuthGate>
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}