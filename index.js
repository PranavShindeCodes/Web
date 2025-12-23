import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import readline from "readline";

// ================= __dirname FIX =================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================= PORTAL CONFIG =================
const UPLOAD_URL = "https://frontend-react-mu-lake.vercel.app/upload-logo";
const uploadedFile = path.join(__dirname, "uploaded.json");

// ================= HELPER FUNCTIONS =================
async function readUploaded() {
  try {
    const data = await fs.readFile(uploadedFile, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveUploaded(list) {
  await fs.writeFile(uploadedFile, JSON.stringify(list, null, 2), "utf-8");
}

function askUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

// ================= SCRAPER =================
async function scrapeCompany(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const $ = cheerio.load(data);

    const companyName = $(".vendor_name h1").text().trim();
    const ticker = $(".ticker_name").text().trim();

    const extractByLabel = (label) =>
      $(`span.blue_txt:contains("${label}")`)
        .parent()
        .contents()
        .filter((i, el) => el.type === "text")
        .text()
        .trim();

    const exchange = extractByLabel("Exchange");
    const industry = extractByLabel("Industry");
    const sector = extractByLabel("Sector");

    const employees = $("li.employees").text().trim();
    const location = $("li.location").text().trim();
    const description = $(".company_description").text().trim();
    const website = $(".btn_visit_website a").attr("href")?.trim();

    const socialLinks = {};
    $("a").each((i, el) => {
      const href = $(el).attr("href")?.trim();
      if (!href) return;
      if (href.includes("linkedin.com")) socialLinks.linkedin = href;
      if (href.includes("twitter.com")) socialLinks.twitter = href;
      if (href.includes("facebook.com")) socialLinks.facebook = href;
      if (href.includes("instagram.com")) socialLinks.instagram = href;
      if (href.includes("youtube.com")) socialLinks.youtube = href;
    });

    let logoUrl = $("img[src*='CompanyLogos']").attr("src");
    if (logoUrl?.startsWith("/"))
      logoUrl = "https://www.annualreports.com" + logoUrl;

    const safeName = companyName.replace(/[^\w\s]/g, "").replace(/\s+/g, "_");
    const folderPath = path.join(__dirname, "data", safeName);
    await fs.mkdir(folderPath, { recursive: true });

    let imageFileName = "N/A";
    const imagePath = path.join(folderPath, `${exchange}_${ticker}.png`);
    if (logoUrl) {
      const imgRes = await axios.get(logoUrl, {
        responseType: "arraybuffer",
      });
      imageFileName = `${exchange}_${ticker}.png`;
      await fs.writeFile(imagePath, imgRes.data);
    }

    const content = `
Company Name : ${companyName}
Ticker       : ${ticker}
Exchange     : ${exchange}
Industry     : ${industry}
Sector       : ${sector}
Employees    : ${employees}
Location     : ${location}
Website      : ${website}

Social Links:
LinkedIn     : ${socialLinks.linkedin || ""}
Twitter      : ${socialLinks.twitter || ""}
Facebook     : ${socialLinks.facebook || ""}
Instagram    : ${socialLinks.instagram || ""}
YouTube      : ${socialLinks.youtube || ""}

Description:
${description}

Logo File:
${imageFileName}

Source URL:
${url}
`.trim();

    await fs.writeFile(path.join(folderPath, "info.txt"), content, "utf-8");
    console.log("✅ DATA + LOGO + SOCIAL LINKS SCRAPED SUCCESSFULLY");

    return {
      companyName,
      ticker,
      exchange,
      industry,
      sector,
      employees,
      location,
      website,
      description,
      imagePath,
      ...socialLinks,
    };
  } catch (err) {
    console.error("❌ Error scraping:", err.message);
    return null;
  }
}

// ================= UPLOADER =================
async function uploadToPortal(data) {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
  });
  const page = await browser.newPage();
  await page.goto(UPLOAD_URL, { waitUntil: "networkidle2" });

  await page.type('input[name="name"]', data.companyName);
  await page.type('input[name="sector"]', data.sector);
  await page.type('input[name="industry"]', data.industry);
  await page.type('input[name="emp_number"]', data.employees);
  await page.type('textarea[name="address"]', data.location);
  await page.type('textarea[name="info"]', data.description);
  await page.type('input[name="web_link"]', data.website || "");
  if (data.linkedin)
    await page.type('input[name="linkedin_link"]', data.linkedin);
  if (data.twitter) await page.type('input[name="twitter_link"]', data.twitter);
  if (data.facebook) await page.type('input[name="face_link"]', data.facebook);
  if (data.instagram)
    await page.type('input[name="insta_link"]', data.instagram);
  if (data.youtube) await page.type('input[name="youtube_link"]', data.youtube);

  // File upload + trigger change event
  const fileInput = await page.$('input[type="file"]');
  if (!fileInput) throw new Error("File input not found!");
  await fileInput.uploadFile(data.imagePath);
  await page.evaluate(
    (el) => el.dispatchEvent(new Event("change", { bubbles: true })),
    fileInput
  );

  // Wait for submit button
  await page.waitForSelector("button[type='submit']");
  const submitButton = await page.$("button[type='submit']");
  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/upload-logo") && res.status() === 200
    ),
    submitButton.click(),
  ]);

  console.log("🚀 UPLOADED TO PORTAL SUCCESSFULLY");
  await browser.close();
}

// ================= MAIN =================
(async () => {
  const uploadedList = await readUploaded();
  const userUrl = await askUser("Paste the company URL here: ");
  if (!userUrl) return console.log("⚠️ No URL provided, exiting...");

  const folderName = userUrl.split("/").pop();
  if (uploadedList.includes(folderName)) {
    console.log(`⚡ Already uploaded: ${folderName}`);
    return;
  }

  const scrapedData = await scrapeCompany(userUrl);
  if (!scrapedData) return;

  try {
    await uploadToPortal(scrapedData);
    uploadedList.push(folderName);
    await saveUploaded(uploadedList);
  } catch (err) {
    console.error("❌ Upload failed:", err.message);
  }
})();
