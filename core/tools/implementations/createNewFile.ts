import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { getCleanUriPath, getUriPathBasename } from "../../util/uri";
import { getStringArg } from "../parseArgs";
import { ContinueError, ContinueErrorReason } from "../../util/errors";

export const createNewFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const contents = getStringArg(args, "contents", true);

  const resolvedFileUri = await inferResolvedUriFromRelativePath(
    filepath,
    extras.ide,
  );
  if (resolvedFileUri) {
    throwIfFileIsSecurityConcern(getCleanUriPath(resolvedFileUri));
    const exists = await extras.ide.fileExists(resolvedFileUri);
    if (exists) {
      throw new ContinueError(
        ContinueErrorReason.FileAlreadyExists,
        `File ${filepath} already exists. Use the edit tool to edit this file`,
      );
    }
    await extras.ide.writeFile(resolvedFileUri, contents);
    // Don't pop the file open in the editor — Continue YOLO runs in agent
    // mode where unsolicited editor pop-ups are disruptive. The user can
    // click the file name in the chat to open it on demand.
    await extras.ide.saveFile(resolvedFileUri);
    if (extras.codeBaseIndexer) {
      void extras.codeBaseIndexer?.refreshCodebaseIndexFiles([resolvedFileUri]);
    }
    return [
      {
        name: getUriPathBasename(resolvedFileUri),
        description: getCleanUriPath(resolvedFileUri),
        content: "File created successfuly",
        uri: {
          type: "file",
          value: resolvedFileUri,
        },
      },
    ];
  } else {
    throw new ContinueError(
      ContinueErrorReason.PathResolutionFailed,
      "Failed to resolve path",
    );
  }
};
