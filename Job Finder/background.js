// Opens the tailoring tabs for batch tailoring and groups them. Lives here because the popup
// closes as soon as tabs open. Each tailoring tab then asks Claude Code (via the local bridge)
// for its resume; the bridge runs up to 3 of them in parallel.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'tailorBatch') return false;
  tailorBatch(msg.jobIds).then(sendResponse, (err) => {
    console.error(err);
    sendResponse({ error: err.message });
  });
  return true; // keeps sendResponse valid for the async reply
});

async function tailorBatch(jobIds) {
  const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tabIds = [];
  let index = current ? current.index + 1 : undefined;
  for (const id of jobIds) {
    const tab = await chrome.tabs.create({
      url: `tailor.html?id=${encodeURIComponent(id)}&auto=1`,
      active: false,
      ...(index != null && { index: index++ }),
    });
    tabIds.push(tab.id);
  }
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, { title: `Resumes (${jobIds.length})`, color: 'blue' });
  await chrome.tabs.update(tabIds[0], { active: true });
  return { tabIds };
}
