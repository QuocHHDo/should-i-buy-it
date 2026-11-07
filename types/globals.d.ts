// Globals the type checker can't see (see tsconfig.json; nothing is built): Chrome's extension API, libraries loaded
// on demand from vendor/, the Claude version's runtime, and the app's shared modules, which each file attaches to
// the page as window.SelfCheck… and are typed by their own files.
declare const chrome: any;
declare const Tesseract: any;
interface Window {
  claude: any; SELF_CHECK_CONFIG: any; Html5Qrcode: any; Html5QrcodeSupportedFormats: any; __Html5QrcodeLibrary__: any;
  SelfCheckData: any; SelfCheckVerdict: any; SelfCheckSources: any; SelfCheckSearch: any; SelfCheckCard: any;
  SelfCheckWalmart: any; SelfCheckCostco: any; SelfCheckSupplement: any; SelfCheckIngredients: any; SelfCheckAdditives: any;
  SelfCheckAdditivesData: any; SelfCheckAdditiveNotes: any; SelfCheckPrices: any; SelfCheckPricesData: any; SelfCheckMeals: any;
  SelfCheckBackup: any; SelfCheckDom: any; SelfCheckCompare: any;
 SelfCheckAlternatives: any; SelfCheckCamera: any; SelfCheckTargets: any; SelfCheckLearn: any; SelfCheckAllergens: any; SelfCheckBookmarklet: any; SelfCheckLabelOcr: any; SelfCheckLabelScan: any;
}
