class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/screenflow/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "5a1262ae26c54c270a6b45128c8a22ba0654da10206dc5595b89382f0c1a3cbf" # updated automatically by release workflow
  license "MIT"
  head "https://github.com/marvinhuelsmann/screenflow.git", branch: "master"

  depends_on "node"

  def install
    system "npm", "ci"
    libexec.install Dir["*"]
    (bin/"screenflow").write <<~SH
      #!/bin/sh
      exec node "#{libexec}/dist/index.js" "$@"
    SH
    zsh_completion.install "completions/_screenflow"
    fish_completion.install "completions/screenflow.fish"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/screenflow --version")
  end
end
