import Image from "next/image";

import { WinterClient } from "@/components/winter/winter-client";
import winterDark from "@/public/winter-has-come.png";
import winterLight from "@/public/winter-has-come-light.png";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <div className="flex justify-center border-b pb-3">
        {/* "WINTER HAS COME" lettering on one line (transparent): dark text on
            the light theme, white text on the dark theme. */}
        <h1>
          <Image
            src={winterLight}
            alt="Winter has come"
            priority
            className="h-auto w-72 sm:w-96 dark:hidden"
          />
          <Image
            src={winterDark}
            alt="Winter has come"
            priority
            className="hidden h-auto w-72 sm:w-96 dark:block"
          />
        </h1>
      </div>
      <WinterClient />
    </main>
  );
}
