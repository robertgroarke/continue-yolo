import { createAsyncThunk } from "@reduxjs/toolkit";
import posthog from "posthog-js";
import { analyzeError } from "../../util/errorAnalysis";
import { selectSelectedChatModel } from "../slices/configSlice";
import { setInlineErrorMessage } from "../slices/sessionSlice";
import { setDialogMessage, setShowDialog } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { cancelStream } from "./cancelStream";
import { saveCurrentSession } from "./session";

export const streamThunkWrapper = createAsyncThunk<
  void,
  () => Promise<void>,
  ThunkApiType
>("chat/streamWrapper", async (runStream, { dispatch, getState }) => {
  try {
    await runStream();
    const state = getState();
    if (!state.session.isInEdit) {
      await dispatch(
        saveCurrentSession({
          openNewSession: false,
          generateTitle: true,
        }),
      );
    }
  } catch (e) {
    const state = getState();
    const selectedModel = selectSelectedChatModel(state);
    const {
      parsedError,
      statusCode,
      modelTitle,
      providerName,
      customErrorMessage,
    } = analyzeError(e, selectedModel);

    await dispatch(cancelStream());
    dispatch(setDialogMessage(undefined));
    dispatch(setShowDialog(false));
    dispatch(
      setInlineErrorMessage({
        type: "stream-error",
        message: customErrorMessage || parsedError,
      }),
    );

    const errorData = {
      error_type: statusCode ? `HTTP ${statusCode}` : "Unknown",
      error_message: parsedError,
      model_provider: providerName,
      model_title: modelTitle,
    };

    posthog.capture("gui_stream_error", errorData);
  }
});
