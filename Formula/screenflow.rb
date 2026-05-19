class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/screenflow/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "4ebbe3235d27fedb39c913c3ebae391c6d489a80453a4be5d353d05c402b000b" # updated automatically by release workflow
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
