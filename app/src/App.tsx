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
import Expenses from "./pages/Expenses";
import ExpensesNew from "./pages/ExpensesNew";
import Cash from "./pages/Cash";
import Relances from "./pages/Relances";
import Settings from "./pages/Settings";
import PublicAccept from "./pages/PublicAccept";
import NotFound from "./pages/NotFound";

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
                  <Route path="/expenses" element={<Expenses />} />
                  <Route path="/expenses/new" element={<ExpensesNew />} />
                  <Route path="/cash" element={<Cash />} />
                  <Route path="/relances" element={<Relances />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </AuthGate>
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}