/**
 * Flat Color (`react-icons/fc`) icons for context menus and dropdown menus.
 * Prefer these over monochrome stroke SVGs so every menu item looks the same.
 */
import {
  FcAddRow,
  FcApprove,
  FcBookmark,
  FcCancel,
  FcComments,
  FcDeleteRow,
  FcDisapprove,
  FcDocument,
  FcDownload,
  FcEditImage,
  FcEmptyTrash,
  FcExport,
  FcExternal,
  FcGlobe,
  FcHeadset,
  FcImport,
  FcMinus,
  FcOpenedFolder,
  FcReading,
  FcRight,
  FcSettings,
  FcSynchronize,
  FcTemplate,
  FcVoicePresentation,
} from "react-icons/fc";

const S = 16;

export function MenuFavoriteIcon({ filled }: { filled?: boolean }) {
  // Flat Color has no outline/filled star pair; bookmark reads as “saved”.
  void filled;
  return <FcBookmark size={S} />;
}

export function MenuRenameIcon() {
  return <FcEditImage size={S} />;
}

export function MenuPropertiesIcon() {
  return <FcSettings size={S} />;
}

export function MenuRevealIcon() {
  return <FcOpenedFolder size={S} />;
}

export function MenuCopyPathIcon() {
  return <FcDocument size={S} />;
}

export function MenuCopyAbsolutePathIcon() {
  return <FcExternal size={S} />;
}

export function MenuOpenChatIcon() {
  return <FcComments size={S} />;
}

export function MenuDownloadIcon() {
  return <FcDownload size={S} />;
}

export function MenuTranslateIcon() {
  return <FcGlobe size={S} />;
}

export function MenuTrashIcon() {
  return <FcEmptyTrash size={S} />;
}

export function MenuCutIcon() {
  return <FcExport size={S} />;
}

export function MenuCopyIcon() {
  return <FcDocument size={S} />;
}

export function MenuPasteIcon() {
  return <FcImport size={S} />;
}

export function MenuCommentIcon() {
  return <FcComments size={S} />;
}

export function MenuCloseIcon() {
  return <FcCancel size={S} />;
}

export function MenuCloseOthersIcon() {
  return <FcDeleteRow size={S} />;
}

export function MenuCloseRemainingIcon() {
  return <FcMinus size={S} />;
}

export function MenuCloseToRightIcon() {
  return <FcRight size={S} />;
}

export function MenuPinIcon() {
  return <FcBookmark size={S} />;
}

export function MenuApproveIcon() {
  return <FcApprove size={S} />;
}

export function MenuDisapproveIcon() {
  return <FcDisapprove size={S} />;
}

export function MenuAddRowIcon() {
  return <FcAddRow size={S} />;
}

export function MenuDeleteRowIcon() {
  return <FcDeleteRow size={S} />;
}

export function MenuDuplicateIcon() {
  return <FcTemplate size={S} />;
}

export function MenuSyncIcon() {
  return <FcSynchronize size={S} />;
}

export function MenuSettingsIcon() {
  return <FcSettings size={S} />;
}

export function MenuIeltsReadingIcon() {
  return <FcReading size={S} />;
}

export function MenuIeltsWritingIcon() {
  return <FcEditImage size={S} />;
}

export function MenuIeltsListeningIcon() {
  return <FcHeadset size={S} />;
}

export function MenuIeltsSpeakingIcon() {
  return <FcVoicePresentation size={S} />;
}
