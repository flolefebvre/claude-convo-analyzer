// fallow-ignore-file unused-file
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// fallow-ignore-next-line unused-export
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
