import { useEffect, useState } from "react";

import ConfirmationDialog from "../shared/ui/ConfirmationDialog";
import {
  NAVIGATION_CONFIRMATION_CANCEL_EVENT,
  NAVIGATION_CONFIRMATION_EVENT,
  type NavigationConfirmationRequest,
} from "./navigationGuard";

export default function NavigationConfirmationDialog() {
  const [request, setRequest] = useState<NavigationConfirmationRequest | null>(null);

  useEffect(() => {
    const handleRequest = (event: Event) => {
      setRequest((event as CustomEvent<NavigationConfirmationRequest>).detail);
    };
    const handleCancel = () => setRequest(null);
    window.addEventListener(NAVIGATION_CONFIRMATION_EVENT, handleRequest);
    window.addEventListener(NAVIGATION_CONFIRMATION_CANCEL_EVENT, handleCancel);
    return () => {
      window.removeEventListener(NAVIGATION_CONFIRMATION_EVENT, handleRequest);
      window.removeEventListener(NAVIGATION_CONFIRMATION_CANCEL_EVENT, handleCancel);
    };
  }, []);

  return (
    <ConfirmationDialog
      open={request !== null}
      title="Несохранённые изменения"
      message={request?.message ?? ""}
      cancelLabel="Остаться"
      confirmLabel="Покинуть редактор"
      onCancel={() => {
        const current = request;
        setRequest(null);
        current?.onCancel?.();
      }}
      onConfirm={() => {
        const current = request;
        setRequest(null);
        current?.onConfirm();
      }}
    />
  );
}
