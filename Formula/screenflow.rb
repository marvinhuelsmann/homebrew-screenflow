class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/homebrew-screenflow/archive/refs/tags/v0.4.17.tar.gz"
  sha256 "1630f07679271a73bd302cc07ff4739f5494d4ac01de05265854f106b6ca0395" # updated automatically by release workflow
  license "MIT"
  head "https://github.com/marvinhuelsmann/screenflow.git", branch: "master"

  depends_on "node"

  def install
    system "npm", "ci"
    zsh_completion.install "completions/_screenflow"
    fish_completion.install "completions/screenflow.fish"
    libexec.install Dir["*"]
    (bin/"screenflow").write <<~SH
      #!/bin/sh
      exec node "#{libexec}/dist/index.js" "$@"
    SH
    (bin/"screenflow-mcp").write <<~SH
      #!/bin/sh
      exec node "#{libexec}/dist/mcp.js" "$@"
    SH
  end

  # Auto-register the MCP server with whatever AI agents are installed. The
  # command is idempotent and skips absent tools, so this never breaks install.
  def post_install
    system bin/"screenflow", "mcp", "install"
  rescue StandardError
    nil
  end

  def caveats
    <<~EOS
      The screenflow MCP server was auto-registered with the AI agents found on
      your machine (Claude Code, Codex, Cursor, Claude Desktop). Restart your
      agent, then ask it to "frame this screenshot in an iPhone".

      Re-run anytime with:  screenflow mcp install
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/screenflow --version")
  end
end
