import { Link } from "react-router-dom";
import { FileQuestion } from "lucide-react";
import { Card } from "../components/ui";

export default function NotFound() {
  return (
    <Card className="text-center">
      <FileQuestion className="mx-auto h-10 w-10 text-ink-4" />
      <h1 className="mt-3 text-lg font-semibold text-ink">Page introuvable</h1>
      <p className="mt-1 text-sm text-ink-3">
        Cette adresse n'existe pas ou a été déplacée.
      </p>
      <Link to="/" className="mt-4 inline-block text-sm text-accent hover:underline">
        Retour au tableau de bord
      </Link>
    </Card>
  );
}
