class Screenflow < Formula
  desc "Wrap simulator screenshots in an iPhone device frame"
  homepage "https://github.com/marvinhuelsmann/screenflow"
  url "https://github.com/marvinhuelsmann/screenflow/archive/refs/tags/v0.2.2.tar.gz"
  sha256 "c047100bcf8326f2010ee05d1d709c47a1bf93e5d6c5c363baf33579c9a7b1f4" # updated automatically by release workflow
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
