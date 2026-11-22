// Reads the text out of a PDF entirely in the browser.
//
// Why in the browser and not on the server? The PDF never has to be uploaded,
// and the Render backend (512 MB RAM) doesn't have to parse big files. The
// extracted text simply goes into the notes box, so flashcards, quizzes,
// summaries and chat all work on it with no backend changes.
//
// pdf.js is large (~1 MB), so it is loaded with import() only the first time
// someone picks a PDF. Everyone else never downloads it.

export const MAX_PDF_BYTES = 25 * 1024 * 1024 // 25 MB

export class PdfReadError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

let pdfjsPromise = null
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      // `?url` asks Vite for the worker file's URL; pdf.js runs it in a Web
      // Worker so reading a big PDF doesn't freeze the page.
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default
      return pdfjs
    }).catch(err => {
      pdfjsPromise = null // allow a retry if the download failed
      throw err
    })
  }
  return pdfjsPromise
}

export const isPdfFile = (file) =>
  file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '')

// Turn one page's raw text into readable lines.
const tidyPageText = (text) => text
  .replace(/[ \t ]+/g, ' ')        // collapse runs of spaces
  .replace(/(\w)-\n(\w)/g, '$1$2')       // re-join words hyphenated across lines
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

/**
 * Extract text from a PDF File.
 * Stops early once it has more than `maxChars` characters (no point reading
 * 300 pages if only the first 12,000 characters can be used).
 * Returns { text, pageCount, pagesRead, truncated }.
 */
export async function extractPdfText(file, { maxChars = Infinity, onProgress } = {}) {
  if (!isPdfFile(file)) {
    throw new PdfReadError('not_pdf', "That file isn't a PDF. Please choose a .pdf file.")
  }
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfReadError('too_big', 'That PDF is over 25 MB. Try splitting it into smaller files.')
  }

  let pdfjs
  try {
    pdfjs = await loadPdfjs()
  } catch {
    throw new PdfReadError('load_failed', "Couldn't load the PDF reader. Check your connection and try again.")
  }

  let pdf
  try {
    const data = new Uint8Array(await file.arrayBuffer())
    pdf = await pdfjs.getDocument({ data }).promise
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new PdfReadError('password', 'That PDF is password-protected. Remove the password and try again.')
    }
    throw new PdfReadError('unreadable', "Couldn't read that PDF. It may be damaged.")
  }

  try {
    const pages = []
    let total = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let raw = ''
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue
        raw += item.str
        if (item.hasEOL) raw += '\n'
      }
      page.cleanup()

      const pageText = tidyPageText(raw)
      if (pageText) {
        pages.push(pageText)
        total += pageText.length + 2
      }
      onProgress?.(pageNumber, pdf.numPages)
      if (total > maxChars) {
        return finish(pages, pdf.numPages, pageNumber, maxChars)
      }
    }
    return finish(pages, pdf.numPages, pdf.numPages, maxChars)
  } finally {
    pdf.destroy()
  }
}

function finish(pages, pageCount, pagesRead, maxChars) {
  const fullText = pages.join('\n\n')
  // Scanned PDFs are pictures of pages: there is no text layer to read.
  if (fullText.replace(/\s/g, '').length < Math.min(40, 10 * pageCount)) {
    throw new PdfReadError(
      'no_text',
      'This PDF has no selectable text (it is probably scanned images). Try a PDF where you can highlight the text.',
    )
  }
  const truncated = fullText.length > maxChars
  return {
    text: truncated ? fullText.slice(0, maxChars) : fullText,
    pageCount,
    pagesRead,
    truncated,
  }
}
