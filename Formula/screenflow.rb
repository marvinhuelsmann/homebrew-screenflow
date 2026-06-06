class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/homebrew-screenflow/archive/refs/tags/v0.3.38.tar.gz"
  sha256 "61392f23a3717a438274d83474ca400c1b3ee161cca1ef61de28d7ff58431f52" # updated automatically by release workflow
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
