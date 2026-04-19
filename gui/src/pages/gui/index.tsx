import { History } from "../../components/History";
import { useAppSelector } from "../../redux/hooks";
import { Chat } from "./Chat";
import { useEffect, useState } from "react";
import { NEW_SESSION_TITLE } from "core/util/constants";

export default function GUI() {
  const historyLength = useAppSelector((state) => state.session.history.length);
  const isRestoringSession = useAppSelector(
    (state) => state.session.isRestoringSession,
  );
  const sessionTitle = useAppSelector((state) => state.session.title);
  const sessionId = useAppSelector((state) => state.session.id);
  const allSessionMetadata = useAppSelector(
    (state) => state.session.allSessionMetadata,
  );
  const [showEditorSessionPicker, setShowEditorSessionPicker] = useState(
    (window as any).isEditorPanel === true,
  );

  useEffect(() => {
    if (!(window as any).isEditorPanel) {
      setShowEditorSessionPicker(false);
      return;
    }

    const isBlankSession =
      historyLength === 0 && sessionTitle === NEW_SESSION_TITLE;

    if (isBlankSession) {
      setShowEditorSessionPicker(true);
    } else {
      setShowEditorSessionPicker(false);
    }
  }, [historyLength, sessionTitle, sessionId]);

  const shouldShowHistoryPane =
    !isRestoringSession &&
    showEditorSessionPicker &&
    allSessionMetadata.length > 0;

  return (
    <div className="flex h-screen w-screen flex-row overflow-hidden">
      <aside
        className={`border-vsc-input-border no-scrollbar h-full w-96 overflow-y-auto border-0 border-r border-solid ${shouldShowHistoryPane ? "flex" : "hidden"}`}
      >
        <History />
      </aside>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Chat />
      </main>
    </div>
  );
}
