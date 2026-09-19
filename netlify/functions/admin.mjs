const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const API_BASE =
  `https://api.github.com/repos/${OWNER}/${REPO}/contents`;

const API_HEADERS = {
  "Accept": "application/vnd.github+json",
  "Authorization": `Bearer ${TOKEN}`,
  "X-GitHub-Api-Version": "2026-03-10",
  "User-Agent": "StudyNest-Admin"
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}


function checkConfig() {
  const missing = [];

  if (!OWNER) missing.push("GITHUB_OWNER");
  if (!REPO) missing.push("GITHUB_REPO");
  if (!TOKEN) missing.push("GITHUB_TOKEN");
  if (!ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");

  return missing;
}


async function github(path, options = {}) {

  const response = await fetch(
    `${API_BASE}/${path}`,
    {
      ...options,
      headers: {
        ...API_HEADERS,
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let body = {};

  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { message: text };
  }

  if (!response.ok) {
    throw new Error(
      body.message ||
      `GitHub API error ${response.status}`
    );
  }

  return body;
}


async function getRepoFile(path) {

  try {

    return await github(
      `${path}?ref=${encodeURIComponent(BRANCH)}`,
      {
        method: "GET"
      }
    );

  } catch (error) {

    if (
      String(error.message)
        .toLowerCase()
        .includes("not found")
    ) {
      return null;
    }

    throw error;
  }
}


async function putRepoFile(
  path,
  contentBase64,
  message
) {

  const existing =
    await getRepoFile(path);

  const body = {

    message,

    content: contentBase64,

    branch: BRANCH

  };

  if (existing && existing.sha) {

    body.sha = existing.sha;

  }

  return await github(
    path,
    {
      method: "PUT",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(body)

    }
  );
}


async function deleteRepoFile(
  path,
  message
) {

  const existing =
    await getRepoFile(path);

  if (!existing) {

    return {
      deleted: false,
      reason: "File not found"
    };

  }

  return await github(
    path,
    {
      method: "DELETE",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify({

          message,

          sha: existing.sha,

          branch: BRANCH

        })

    }
  );
}


function cleanFileName(name) {

  return String(name)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 150);

}


async function getContentData() {

  const file =
    await getRepoFile(
      "site/content.json"
    );

  if (!file || !file.content) {

    return {
      sha: null,

      data: {
        courses: [],
        videos: [],
        pdfs: [],
        toppers: []
      }

    };

  }

  const decoded =
    Buffer.from(
      file.content.replace(/\n/g, ""),
      "base64"
    ).toString("utf8");

  return {

    sha: file.sha,

    data: JSON.parse(decoded)

  };

}


async function saveContentData(data) {

  const cleanData = {

    courses:
      Array.isArray(data.courses)
        ? data.courses
        : [],

    videos:
      Array.isArray(data.videos)
        ? data.videos
        : [],

    pdfs:
      Array.isArray(data.pdfs)
        ? data.pdfs
        : [],

    toppers:
      Array.isArray(data.toppers)
        ? data.toppers
        : []

  };


  const jsonText =
    JSON.stringify(
      cleanData,
      null,
      2
    );


  const contentBase64 =
    Buffer.from(
      jsonText,
      "utf8"
    ).toString("base64");


  await putRepoFile(
    "site/content.json",
    contentBase64,
    "StudyNest: update content"
  );


  return cleanData;
}


async function verifyPassword(password) {

  return (
    typeof password === "string" &&
    password.length > 0 &&
    password === ADMIN_PASSWORD
  );

}


export default async function handler(request) {

  try {

    const missing =
      checkConfig();

    if (missing.length) {

      return json(
        {
          ok: false,

          error:
            "Netlify environment variables missing: "
            +
            missing.join(", ")

        },

        500
      );

    }


    if (
      request.method !==
      "POST"
    ) {

      return json(
        {
          ok: false,
          error: "POST only"
        },
        405
      );

    }


    const body =
      await request.json();


    const {
      action,
      password
    } = body;


    if (
      !await verifyPassword(
        password
      )
    ) {

      return json(
        {
          ok: false,
          error: "Unauthorized"
        },
        401
      );

    }


    /* =====================================================
       LOGIN
    ===================================================== */

    if (
      action ===
      "login"
    ) {

      return json({
        ok: true
      });

    }


    /* =====================================================
       SAVE CONTENT.JSON
    ===================================================== */

    if (
      action ===
      "saveData"
    ) {

      if (!body.data) {

        return json(
          {
            ok: false,
            error: "Data missing"
          },
          400
        );

      }


      const saved =
        await saveContentData(
          body.data
        );


      return json({
        ok: true,
        data: saved
      });

    }


    /* =====================================================
       UPLOAD FILE
    ===================================================== */

    if (
      action ===
      "uploadFile"
    ) {

      const fileName =
        cleanFileName(
          body.fileName ||
          ""
        );


      const base64 =
        body.contentBase64;


      const folder =
        body.folder ||
        "pdfs";


      const size =
        Number(
          body.size || 0
        );


      if (
        !fileName ||
        !base64
      ) {

        return json(
          {
            ok: false,
            error:
              "File data missing"
          },
          400
        );

      }


      if (
        size >
        MAX_FILE_BYTES
      ) {

        return json(
          {
            ok: false,

            error:
              "File is too large. " +
              "Maximum upload size is 4 MB."
          },
          400
        );

      }


      let safeFolder =
        String(folder)
          .replace(/^\/+|\/+$/g, "")
          .replace(/\.\./g, "");


      const id =
        Date.now().toString(36) +
        "-" +
        Math.random()
          .toString(36)
          .slice(2, 8);


      const finalPath =
        `${safeFolder}/${id}-${fileName}`;


      await putRepoFile(
        finalPath,
        base64,
        `StudyNest: upload ${fileName}`
      );


      return json({
        ok: true,

        path: finalPath,

        fileName: fileName

      });

    }


    /* =====================================================
       DELETE FILE
    ===================================================== */

    if (
      action ===
      "deleteFile"
    ) {

      const path =
        String(
          body.path || ""
        )
        .replace(/^\/+/, "");


      if (
        !path ||
        path.includes("..")
      ) {

        return json(
          {
            ok: false,
            error: "Invalid path"
          },
          400
        );

      }


      await deleteRepoFile(
        path,
        "StudyNest: delete file"
      );


      return json({
        ok: true
      });

    }


    return json(
      {
        ok: false,
        error: "Unknown action"
      },
      400
    );

  }
  catch(error) {

    console.error(
      "StudyNest admin error:",
      error
    );


    return json(
      {
        ok: false,

        error:
          error.message ||
          "Server error"

      },
      500
    );

  }

}