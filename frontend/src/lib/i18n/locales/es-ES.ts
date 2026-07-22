import type { TranslationDict } from "../types";

import ui from "./ui/es-ES";
import tasks from "./tasks/es-ES";
import blocklist from "./blocklist/es-ES";
import api from "./api/es-ES";
import log from "./log/es-ES";

const esES: TranslationDict = {
  ...ui,
  ...tasks,
  ...blocklist,
  ...api,
  ...log,
};

export default esES;
