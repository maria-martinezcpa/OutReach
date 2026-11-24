// Every request the extension can make, shared by native-host.js and server.js.
const { findClaude, runClaude } = require('./claude');
const fs = require('fs');
const path = require('path');
const { checkDir, saveJob, listJobs, getJob, updateJob, deleteJob, openFolder, openFile } = require('./save');
const { htmlToPdf } = require('./pdf');

// Saves the job, renders the PDF from the resume.html kept in .data/<number>/ (a short path, so
// Chrome's export never hits the Windows path limit), then puts "Resume - Company - Role.pdf"
// in the job folder. A PDF failure doesn't undo the save; it's reported as pdfError.
function saveWithPdf(msg) {
  const result = saveJob(msg.dir, msg.job, msg.files, msg.status);
  if (result.html && msg.pdf !== false) {
    try {
      const rendered = htmlToPdf(result.html);
      const dest = path.join(result.path, `${result.resumeName}.pdf`);
      fs.copyFileSync(rendered, dest);
      // A resume PDF saved earlier under another name (job renamed) would be a confusing duplicate.
      for (const name of fs.readdirSync(result.path)) {
        if (/^Resume - .+\.pdf$/.test(name) && name !== path.basename(dest)) fs.rmSync(path.join(result.path, name), { force: true });
      }
      result.pdf = dest;
    } catch (e) {
      result.pdfError = e.message;
    }
  }
  return result;
}

// `run` lets the HTTP bridge put tailoring requests through its parallel-limit queue.
async function handle(msg, { run = runClaude } = {}) {
  switch (msg?.type) {
    case 'ping': {
      const claudePath = findClaude();
      return { ok: Boolean(claudePath), claudePath };
    }
    case 'tailor':
      return run(findClaude(), msg.prompt);
    case 'checkDir':
      return checkDir(msg.dir);
    case 'save':
      return saveWithPdf(msg);
    case 'listJobs':
      return listJobs(msg.dir);
    case 'getJob':
      return getJob(msg.dir, msg.index);
    case 'updateJob':
      return updateJob(msg.dir, msg.index, msg.fields);
    case 'deleteJob':
      return deleteJob(msg.dir, msg.index);
    case 'openFolder':
      return openFolder(msg.dir, msg.index);
    case 'openFile':
      return openFile(msg.dir, msg.file);
    default:
      throw new Error(`Unknown request: ${msg?.type}`);
  }
}

module.exports = { handle };
