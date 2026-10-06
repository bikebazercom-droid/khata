import { useEffect } from "react";

type PageMetaProps = {
  title: string;
  description: string;
};

type MetaTag = {
  selector: string;
  attribute: "name" | "property";
  key: string;
  content: string;
};

export function PageMeta({ title, description }: PageMetaProps) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const tags: MetaTag[] = [
      { selector: 'meta[name="description"]', attribute: "name", key: "description", content: description },
      { selector: 'meta[property="og:title"]', attribute: "property", key: "og:title", content: title },
      { selector: 'meta[property="og:description"]', attribute: "property", key: "og:description", content: description },
      { selector: 'meta[name="twitter:title"]', attribute: "name", key: "twitter:title", content: title },
      { selector: 'meta[name="twitter:description"]', attribute: "name", key: "twitter:description", content: description },
    ];

    const previousTags = tags.map((tag) => {
      let element = document.head.querySelector<HTMLMetaElement>(tag.selector);
      const created = !element;

      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(tag.attribute, tag.key);
        document.head.appendChild(element);
      }

      const previousContent = element.getAttribute("content");
      element.setAttribute("content", tag.content);
      return { element, created, previousContent };
    });

    return () => {
      document.title = previousTitle;
      for (const { element, created, previousContent } of previousTags) {
        if (created) {
          element.remove();
        } else if (previousContent !== null) {
          element.setAttribute("content", previousContent);
        } else {
          element.removeAttribute("content");
        }
      }
    };
  }, [title, description]);

  return null;
}
