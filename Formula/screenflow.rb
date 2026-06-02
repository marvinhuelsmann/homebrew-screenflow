class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/homebrew-screenflow/archive/refs/tags/v0.3.36.tar.gz"
  sha256 "1990197107fe0b7358b5ec252d6fb49305a8db420ba964d95f1164556d0846a5" # updated automatically by release workflow
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
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/screenflow --version")
  end
end
