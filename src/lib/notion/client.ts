import { APIResponseError, Client } from '@notionhq/client'
import retry from 'async-retry'

import {
  DATABASE_ID,
  NOTION_API_SECRET,
  NUMBER_OF_POSTS_PER_PAGE,
} from '../../server-constants'

import type {
  Block,
  Database,
  Post,
} from '../interfaces'

import type * as responses from './responses'

const client = new Client({
  auth: NOTION_API_SECRET,
  notionVersion: '2022-06-28',
})

let postsCache: Post[] | null = null
let dbCache: Database | null = null

const numberOfRetry = 2

/**
 * Notionデータベースを取得
 */
export async function getDatabase(): Promise<Database> {
  if (dbCache !== null) {
    return dbCache
  }

  const res = await retry(
    async (bail) => {
      try {
        return (await client.databases.retrieve({
          database_id: DATABASE_ID,
        })) as responses.RetrieveDatabaseResponse
      } catch (error: unknown) {
        if (error instanceof APIResponseError) {
          if (error.status >= 400 && error.status < 500) {
            bail(error)
          }
        }

        throw error
      }
    },
    {
      retries: numberOfRetry,
    }
  )

  dbCache = _buildDatabase(res)

  return dbCache
}

/**
 * 公開済みの全記事を取得
 */
export async function getAllPosts(): Promise<Post[]> {
  if (postsCache !== null) {
    return postsCache
  }

  const results: responses.PageObject[] = []

  let startCursor: string | undefined = undefined

  while (true) {
    const params: any = {
      database_id: DATABASE_ID,
      filter: {
        property: 'Published',
        checkbox: {
          equals: true,
        },
      },
      page_size: 100,
    }

    if (startCursor) {
      params.start_cursor = startCursor
    }

    const res = await retry(
      async (bail) => {
        try {
          return (await client.databases.query(
            params
          )) as responses.QueryDatabaseResponse
        } catch (error: unknown) {
          if (error instanceof APIResponseError) {
            if (error.status >= 400 && error.status < 500) {
              bail(error)
            }
          }

          throw error
        }
      },
      {
        retries: numberOfRetry,
      }
    )

    results.push(...res.results)

    if (!res.has_more || !res.next_cursor) {
      break
    }

    startCursor = res.next_cursor
  }

  postsCache = results
    .filter(_validPageObject)
    .map(_buildPost)

  return postsCache
}

/**
 * 最新記事
 */
export async function getPosts(
  pageSize = NUMBER_OF_POSTS_PER_PAGE
): Promise<Post[]> {
  const allPosts = await getAllPosts()

  return allPosts.slice(0, pageSize)
}

/**
 * おすすめ記事
 */
export async function getRankedPosts(
  pageSize = NUMBER_OF_POSTS_PER_PAGE
): Promise<Post[]> {
  const allPosts = await getAllPosts()

  return allPosts.slice(0, pageSize)
}

/**
 * Slugから記事を取得
 */
export async function getPostBySlug(
  slug: string
): Promise<Post | null> {
  const allPosts = await getAllPosts()

  return (
    allPosts.find((post) => post.Slug === slug) || null
  )
}

/**
 * Notion Page IDから記事を取得
 */
export async function getPostByPageId(
  pageId: string
): Promise<Post | null> {
  const allPosts = await getAllPosts()

  return (
    allPosts.find((post) => post.PageId === pageId) || null
  )
}

/**
 * 全タグを取得
 */
export async function getAllTags(): Promise<string[]> {
  const allPosts = await getAllPosts()

  const tags = allPosts.flatMap(
    (post) => post.Tags || []
  )

  return [...new Set(tags)].sort()
}

/**
 * タグで記事を取得
 */
export async function getPostsByTag(
  tagName: string,
  pageSize = NUMBER_OF_POSTS_PER_PAGE
): Promise<Post[]> {
  const allPosts = await getAllPosts()

  return allPosts
    .filter((post) =>
      (post.Tags || []).includes(tagName)
    )
    .slice(0, pageSize)
}

/**
 * ページ番号から記事を取得
 */
export async function getPostsByPage(
  page: number
): Promise<Post[]> {
  const allPosts = await getAllPosts()

  const start =
    (page - 1) * NUMBER_OF_POSTS_PER_PAGE

  const end =
    start + NUMBER_OF_POSTS_PER_PAGE

  return allPosts.slice(start, end)
}

/**
 * タグ＋ページ番号から記事を取得
 */
export async function getPostsByTagAndPage(
  tagName: string,
  page: number
): Promise<Post[]> {
  const posts = await getPostsByTag(
    tagName,
    Number.MAX_SAFE_INTEGER
  )

  const start =
    (page - 1) * NUMBER_OF_POSTS_PER_PAGE

  const end =
    start + NUMBER_OF_POSTS_PER_PAGE

  return posts.slice(start, end)
}

/**
 * 全ページ数
 */
export async function getNumberOfPages(): Promise<number> {
  const allPosts = await getAllPosts()

  return Math.max(
    1,
    Math.ceil(
      allPosts.length /
        NUMBER_OF_POSTS_PER_PAGE
    )
  )
}

/**
 * タグ別ページ数
 */
export async function getNumberOfPagesByTag(
  tagName: string
): Promise<number> {
  const posts = await getPostsByTag(
    tagName,
    Number.MAX_SAFE_INTEGER
  )

  return Math.max(
    1,
    Math.ceil(
      posts.length /
        NUMBER_OF_POSTS_PER_PAGE
    )
  )
}

/**
 * Notionブロックを取得
 */
export async function getAllBlocksByBlockId(
  blockId: string
): Promise<Block[]> {
  const blocks: any[] = []

  let startCursor: string | undefined = undefined

  while (true) {
    const params: any = {
      block_id: blockId,
      page_size: 100,
    }

    if (startCursor) {
      params.start_cursor = startCursor
    }

    const res = await retry(
      async (bail) => {
        try {
          return await client.blocks.children.list(
            params
          )
        } catch (error: unknown) {
          if (error instanceof APIResponseError) {
            if (error.status >= 400 && error.status < 500) {
              bail(error)
            }
          }

          throw error
        }
      },
      {
        retries: numberOfRetry,
      }
    )

    blocks.push(...res.results)

    if (!res.has_more || !res.next_cursor) {
      break
    }

    startCursor = res.next_cursor
  }

  return blocks as Block[]
}

/**
 * Notionページとして有効か確認
 */
function _validPageObject(
  pageObject: responses.PageObject
): boolean {
  return Boolean(pageObject && pageObject.id)
}

/**
 * Notionページ → サイト用Postへ変換
 */
function _buildPost(
  pageObject: responses.PageObject
): Post {
  const properties =
    pageObject.properties as Record<string, any>

  /**
   * 配信タイトル
   */
  const titleProperty =
    properties['配信タイトル'] ||
    properties['Name'] ||
    properties['名前']

  const title =
    titleProperty?.title?.[0]?.plain_text ||
    '無題の配信'

  /**
   * 配信日
   */
  const date =
    properties['配信日']?.date?.start ||
    properties['Date']?.date?.start ||
    ''

  /**
   * タグ
   *
   * 「分類」がマルチセレクトの場合を想定
   */
  const classification =
    properties['分類']

  let tags: string[] = []

  if (classification?.multi_select) {
    tags = classification.multi_select
      .map((item: any) => item.name)
      .filter(Boolean)
  }

  /**
   * 曲名
   */
  const songTitle =
    _getTextProperty(
      properties['曲名']
    )

  /**
   * アーティスト名
   */
  const artistName =
    _getTextProperty(
      properties['アーティスト名']
    )

  /**
   * YouTubeリンク
   */
  const youtubeLink =
    _getUrlProperty(
      properties['Youtubeリンク']
    ) ||
    _getUrlProperty(
      properties['YouTubeリンク']
    )

  /**
   * サイト内で使うSlug
   *
   * 現時点ではNotion Page IDを使用
   */
  const slug = pageObject.id

  /**
   * 検索などで使いやすいExcerpt
   */
  const excerptParts = [
    songTitle,
    artistName,
  ].filter(Boolean)

  const excerpt =
    excerptParts.length > 0
      ? excerptParts.join(' / ')
      : title

  return {
    PageId: pageObject.id,
    Title: title,
    Slug: slug,
    Date: date,
    Tags: tags,
    LastEditedTime:
      pageObject.last_edited_time,
    Excerpt: excerpt,
    Rank: 0,

    // 以下はPost型に存在する場合のみ利用
    ...(songTitle
      ? { SongTitle: songTitle }
      : {}),
    ...(artistName
      ? { ArtistName: artistName }
      : {}),
    ...(youtubeLink
      ? { YoutubeLink: youtubeLink }
      : {}),
  } as Post
}

/**
 * テキスト系Notionプロパティから文字列取得
 */
function _getTextProperty(
  property: any
): string {
  if (!property) {
    return ''
  }

  if (property.title?.length) {
    return property.title
      .map((item: any) => item.plain_text || '')
      .join('')
  }

  if (property.rich_text?.length) {
    return property.rich_text
      .map((item: any) => item.plain_text || '')
      .join('')
  }

  if (typeof property.select?.name === 'string') {
    return property.select.name
  }

  return ''
}

/**
 * URLプロパティからURL取得
 */
function _getUrlProperty(
  property: any
): string {
  if (!property) {
    return ''
  }

  if (typeof property.url === 'string') {
    return property.url
  }

  return ''
}

/**
 * データベース情報をサイト用Databaseへ変換
 */
function _buildDatabase(
  res: responses.RetrieveDatabaseResponse
): Database {
  const title =
    res.title?.[0]?.plain_text ||
    '歌枠まとめ'

  return {
    Title: title,
    Description: '',
    Icon: null,
    Cover: null,
  }
}
