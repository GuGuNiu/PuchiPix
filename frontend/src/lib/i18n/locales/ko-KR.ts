import type { TranslationDict } from "../types";

import ui from "./ui/ko-KR";
import tasks from "./tasks/ko-KR";
import blocklist from "./blocklist/ko-KR";
import api from "./api/ko-KR";
import log from "./log/ko-KR";

const koKR: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default koKR;
