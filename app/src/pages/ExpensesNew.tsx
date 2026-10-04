import { useNavigate } from "react-router-dom";
import Expenses from "./Expenses";
import { useEffect } from "react";

export default function ExpensesNew() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClose = () => navigate("/expenses");
    window.addEventListener("expense-form-closed", onClose as any);
    window.dispatchEvent(new CustomEvent("open-expense-form"));
    return () => window.removeEventListener("expense-form-closed", onClose as any);
  }, [navigate]);
  return <Expenses />;
}
