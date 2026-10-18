import { t } from "../../i18n";

export default (key) => {
  const name = key === "needToPrepareDict" ? key + "_" + BROWSER : key;
  const value = t(`dictionary.${name}`);
  return value === `dictionary.${name}` ? null : value;
};
