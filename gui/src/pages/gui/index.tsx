import { History } from "../../components/History";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { refreshSessionMetadata } from "../../redux/thunks/session";
import { Chat } from "./Chat";
import { useEffect, useState } from "react";
import { NEW_SESSION_TITLE } from "core/util/constants";

export default function GUI() {
  const dispatch = useAppDispatch();
  const historyLength = useAppSelector((state) => state.session.history.length);
  const isRestoringSession = useAppSelector(
    (state) => state.session.isRestoringSession,
  );
  const sessionTitle = useAppSelector((state) => state.session.title);
  const sessionId = useAppSelector((state) => state.session.id);
  const allSessionMetadata = useAppSelector(
    (state) => state.session.allSessionMetadata,
  );
  const isSessionMetadataLoading = useAppSelector(
    (state) => state.session.isSessionMetadataLoading,
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

  useEffect(() => {
    if (
      (window as any).isEditorPanel !== true ||
      !showEditorSessionPicker ||
      isRestoringSession ||
      isSessionMetadataLoading ||
      allSessionMetadata.length > 0
    ) {
      return;
    }

    void dispatch(refreshSessionMetadata({}));
  }, [
    allSessionMetadata.length,
    dispatch,
    isRestoringSession,
    isSessionMetadataLoading,
    showEditorSessionPicker,
  ]);

  const shouldShowHistoryPane = !isRestoringSession && showEditorSessionPicker;

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
