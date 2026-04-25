import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useContext } from "react";
import { renderChatMessage } from "core/util/messageContent";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { ChatHistoryItemWithMessageId } from "../../redux/slices/sessionSlice";
import { setInlineErrorMessage } from "../../redux/slices/sessionSlice";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import { useMainEditor } from "./TipTapEditor";

export type InlineErrorMessageType =
  | "out-of-context"
  | {
      type: "stream-error";
      message: string;
    };

function getRetryPayload(
  history: ChatHistoryItemWithMessageId[],
  mainEditor: ReturnType<typeof useMainEditor>["mainEditor"],
) {
  let index = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].message.role === "user") {
      index = i;
      break;
    }
  }

  if (index === -1) {
    if (!mainEditor) {
      return undefined;
    }

    return {
      editorState: mainEditor.getJSON(),
      index: 0,
    };
  }

  const historyItem = history[index];
  const fallbackText = renderChatMessage(historyItem.message);
  const editorState =
    historyItem.editorState ??
    ({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: fallbackText
            ? [
                {
                  type: "text",
                  text: fallbackText,
                },
              ]
            : [],
        },
      ],
    } as const);

  return { editorState, index };
}

export default function InlineErrorMessage() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const { mainEditor } = useMainEditor();
  const inlineErrorMessage = useAppSelector(
    (state) => state.session.inlineErrorMessage,
  );
  const history = useAppSelector((state) => state.session.history);

  const retryLastMessage = () => {
    const retryPayload = getRetryPayload(history, mainEditor);
    if (!retryPayload) {
      console.error("Retry payload not found, cannot retry last message.");
      return;
    }

    void dispatch(
      streamResponseThunk({
        editorState: retryPayload.editorState,
        modifiers: {
          noContext: true,
          useCodebase: false,
        },
        index: retryPayload.index,
      }),
    );
  };

  if (inlineErrorMessage === "out-of-context") {
    return (
      <div
        className={`border-border relative m-2 flex flex-col rounded-md border border-solid bg-transparent p-4`}
      >
        <p className={`thread-message text-error text-center`}>
          {`Message exceeds context limit.`}
        </p>
        <div className="text-description flex flex-row items-center justify-center gap-1.5 px-3">
          <div
            className="cursor-pointer text-xs hover:underline"
            onClick={() => {
              ideMessenger.post("config/openProfile", {
                profileId: undefined,
              });
            }}
          >
            <span className="xs:flex hidden">Open config</span>
            <span className="xs:hidden">Config</span>
          </div>
          |
          <span
            className="cursor-pointer text-xs hover:underline"
            onClick={() => {
              dispatch(setInlineErrorMessage(undefined));
            }}
          >
            Hide
          </span>
        </div>
      </div>
    );
  }

  if (
    inlineErrorMessage &&
    typeof inlineErrorMessage === "object" &&
    inlineErrorMessage.type === "stream-error"
  ) {
    return (
      <div className="border-border relative m-2 flex flex-col gap-3 rounded-md border border-solid bg-transparent p-4">
        <p className="thread-message text-error m-0 text-left">
          {inlineErrorMessage.message}
        </p>
        <div className="flex flex-row items-center gap-3">
          <button
            className="border-border bg-input hover:bg-button-hover flex cursor-pointer items-center gap-2 rounded-md border border-solid px-3 py-1.5 text-xs"
            onClick={() => {
              dispatch(setInlineErrorMessage(undefined));
              retryLastMessage();
            }}
          >
            <ArrowPathIcon className="h-3.5 w-3.5" />
            <span>Retry last message</span>
          </button>
          <button
            className="text-description cursor-pointer border-none bg-transparent p-0 text-xs hover:underline"
            onClick={() => {
              dispatch(setInlineErrorMessage(undefined));
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
